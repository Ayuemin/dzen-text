#include <jni.h>
#include <algorithm>
#include <exception>
#include <memory>
#include <string>
#include <vector>

#include "hunspell.hxx"

namespace {

std::string jstringUtf8(JNIEnv* env, jstring value) {
    if (value == nullptr) return {};
    const char* chars = env->GetStringUTFChars(value, nullptr);
    if (chars == nullptr) return {};
    std::string out(chars);
    env->ReleaseStringUTFChars(value, chars);
    return out;
}

void throwRuntime(JNIEnv* env, const std::string& message) {
    jclass cls = env->FindClass("java/lang/RuntimeException");
    if (cls != nullptr) env->ThrowNew(cls, message.c_str());
}

Hunspell* ptr(jlong handle) {
    return reinterpret_cast<Hunspell*>(static_cast<intptr_t>(handle));
}

}  // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_io_github_ayuemin_texteditor_spellprobe_hunspell_HunspellRussianProbe_nativeCreate(
        JNIEnv* env, jclass, jstring affPath, jstring dicPath) {
    try {
        const std::string aff = jstringUtf8(env, affPath);
        const std::string dic = jstringUtf8(env, dicPath);
        auto instance = std::make_unique<Hunspell>(aff.c_str(), dic.c_str());
        return static_cast<jlong>(reinterpret_cast<intptr_t>(instance.release()));
    } catch (const std::exception& e) {
        throwRuntime(env, std::string("Hunspell init failed: ") + e.what());
        return 0;
    } catch (...) {
        throwRuntime(env, "Hunspell init failed: unknown native exception");
        return 0;
    }
}

extern "C" JNIEXPORT void JNICALL
Java_io_github_ayuemin_texteditor_spellprobe_hunspell_HunspellRussianProbe_nativeDestroy(
        JNIEnv*, jclass, jlong handle) {
    delete ptr(handle);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_io_github_ayuemin_texteditor_spellprobe_hunspell_HunspellRussianProbe_nativeSpell(
        JNIEnv* env, jclass, jlong handle, jstring word) {
    Hunspell* hun = ptr(handle);
    if (hun == nullptr) return JNI_FALSE;
    try {
        return hun->spell(jstringUtf8(env, word)) ? JNI_TRUE : JNI_FALSE;
    } catch (const std::exception& e) {
        throwRuntime(env, std::string("Hunspell spell failed: ") + e.what());
        return JNI_FALSE;
    }
}

extern "C" JNIEXPORT jobjectArray JNICALL
Java_io_github_ayuemin_texteditor_spellprobe_hunspell_HunspellRussianProbe_nativeSuggest(
        JNIEnv* env, jclass, jlong handle, jstring word, jint limit) {
    jclass stringClass = env->FindClass("java/lang/String");
    if (stringClass == nullptr) return nullptr;
    Hunspell* hun = ptr(handle);
    if (hun == nullptr) return env->NewObjectArray(0, stringClass, nullptr);
    try {
        std::vector<std::string> suggestions = hun->suggest(jstringUtf8(env, word));
        const int count = std::min<int>(std::max<int>(0, limit), suggestions.size());
        jobjectArray out = env->NewObjectArray(count, stringClass, nullptr);
        for (int i = 0; i < count; ++i) {
            jstring item = env->NewStringUTF(suggestions[i].c_str());
            env->SetObjectArrayElement(out, i, item);
            env->DeleteLocalRef(item);
        }
        return out;
    } catch (const std::exception& e) {
        throwRuntime(env, std::string("Hunspell suggest failed: ") + e.what());
        return nullptr;
    }
}
