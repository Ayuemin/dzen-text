cmake_minimum_required(VERSION 3.22.1)
project(hunspell_probe LANGUAGES CXX)

set(HUN ${CMAKE_CURRENT_SOURCE_DIR}/vendor/hunspell)
if(NOT EXISTS "${HUN}/hunspell.cxx")
    message(FATAL_ERROR "Hunspell sources missing. Run tools/prepare_hunspell_probe.sh before Gradle.")
endif()

add_library(hunspell-core STATIC
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
target_include_directories(hunspell-core PUBLIC ${HUN})
target_compile_definitions(hunspell-core PRIVATE HUNSPELL_STATIC BUILDING_LIBHUNSPELL)
target_compile_options(hunspell-core PRIVATE -Wno-deprecated-declarations)

add_library(hunspell-probe SHARED native_hunspell.cpp)
target_include_directories(hunspell-probe PRIVATE ${HUN})
target_compile_definitions(hunspell-probe PRIVATE HUNSPELL_STATIC)
target_link_libraries(hunspell-probe PRIVATE hunspell-core)
