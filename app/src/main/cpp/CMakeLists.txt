cmake_minimum_required(VERSION 3.22.1)
project(hunspell_editor LANGUAGES CXX)

# tools/prepare_hunspell_probe.sh prepares the pinned upstream tree once and
# both the isolated probe and the production editor compile that exact source.
set(HUN ${CMAKE_CURRENT_SOURCE_DIR}/../../../../spellprobe-hunspell/src/main/cpp/vendor/hunspell)
if(NOT EXISTS "${HUN}/hunspell.cxx")
    message(FATAL_ERROR "Hunspell sources missing. Run tools/prepare_hunspell_probe.sh before Gradle.")
endif()

add_library(hunspell-core-editor STATIC
    ${HUN}/affentry.cxx
    ${HUN}/affixmgr.cxx
    ${HUN}/csutil.cxx
    ${HUN}/filemgr.cxx
    ${HUN}/hashmgr.cxx
    ${HUN}/hunspell.cxx
    ${HUN}/hunzip.cxx
    ${HUN}/phonet.cxx
    ${HUN}/replist.cxx
    ${HUN}/suggestmgr.cxx
)
target_include_directories(hunspell-core-editor PUBLIC ${HUN})
target_compile_definitions(hunspell-core-editor PRIVATE HUNSPELL_STATIC BUILDING_LIBHUNSPELL)
target_compile_options(hunspell-core-editor PRIVATE -Wno-deprecated-declarations)

add_library(hunspell-editor SHARED native_hunspell_editor.cpp)
target_include_directories(hunspell-editor PRIVATE ${HUN})
target_compile_definitions(hunspell-editor PRIVATE HUNSPELL_STATIC)
target_link_libraries(hunspell-editor PRIVATE hunspell-core-editor)
