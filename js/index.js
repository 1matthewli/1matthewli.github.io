// Floating label headings for the contact form
$(function() {
    $("body").on("input propertychange", ".floating-label-form-group", function(e) {
        $(this).toggleClass("floating-label-form-group-with-value", !!$(e.target).val());
    }).on("focus", ".floating-label-form-group", function() {
        $(this).addClass("floating-label-form-group-with-focus");
    }).on("blur", ".floating-label-form-group", function() {
        $(this).removeClass("floating-label-form-group-with-focus");
    });
});

var currentPage = 'home';

function largePageChanges() {
    $('#intro-header-main').css("height", '100%');
    $('#intro-header-main').css("min-height", '0px');
    $('footer').css('position', 'absolute');
    $('footer').css('bottom', '-5px');
    $('html').css('overflow-y', 'hidden');
    $('body').css('overflow-y', 'hidden');
}

function smallPageChanges() {
    $('#intro-header-main').css("height", '350px');
    $('#intro-header-main').css("min-height", '350px');
    $('footer').css('display', 'relative');
    $('footer').css('bottom', '');
    $('html').css('overflow-y', '');
    $('body').css('overflow-y', '');
}

function introAnimation (start_page) {
    var initialDelay = 600;
    var headerDelay = 800;

    var pages = ['home', 'about', 'resume', 'contact'];
    var item = pages[start_page];
    currentPage = item;

    $('#intro-header-main').css('background-image', "url('img/"+item+"-bg.jpg')");
    if (item === 'home' || item === 'contact') {
        largePageChanges();
    }
    else {
        smallPageChanges();
    }

    $('#intro-header-main').delay(initialDelay).fadeIn();
    $('.'+item+'-header').delay(headerDelay + initialDelay).fadeIn();

    if (start_page != 0) {
        $('.'+item+'-content').delay(headerDelay + initialDelay).fadeIn();
    }

    $('.navbar-custom').delay(2 * headerDelay + initialDelay).fadeIn();
    $('footer').delay(2 * headerDelay  + initialDelay).fadeIn();
}

var menuClicked = false;

$(document).ready(function() {
    var url = window.location.href;
    var page = url.substring(url.indexOf('#') + 1);

    var pages = ['home', 'about', 'resume', 'contact'];
    var start_page = pages.indexOf(page) === -1 ? 0 : pages.indexOf(page);
    // if (start_page == 2) // temporarily removing resume page
    //     start_page = 0

    var movementStrength = 10;
    var height = movementStrength / $(document).height();
    var width = movementStrength / $(document).width();

    $('#menu-button').mouseup(function(e) {
        menuClicked = true;
    })

    var page_functions = pages.map(function(item, index) {
        return (function(e) {

            if (currentPage !== item) {
                $('.' + currentPage + '-content').hide();
                if (item === 'contact') {
                    $('.' + item + '-content').delay(200).fadeIn(600);
                }
                else {
                    $('.' + item + '-content').fadeIn(600);
                }

                $('.' + currentPage + '-header').hide();
                $('.' + item + '-header').fadeIn(600);


                if (item === 'home' || item === 'contact') {
                    if (currentPage !== 'home' && currentPage !== 'contact')
                        $('footer').hide();
                    largePageChanges();
                    if (currentPage !== 'home' && currentPage !== 'contact')
                        $('footer').delay(600).fadeIn(400);
                }
                else {

                    smallPageChanges();

                }

                $('#intro-header-main').delay(100).queue(function (next) {
                    $(this).css('background-image', "url('img/"+item+"-bg.jpg')");
                    next();
                });
                currentPage = item;
            }
            if (menuClicked)
                $('#bs-example-navbar-collapse-1').collapse("toggle");

            menuClicked = false;
        });
    });

    introAnimation(start_page);

    pages.map(function(item, index) {
        $('.' + item + '-button').mouseup(page_functions[index])
    });

    $(document).mousemove(function(e){

      var pageX = e.pageX - ($(document).width() / 2);
      var pageY = e.pageY - ($(document).height() / 2);
      var weight = 0.8;
      var newvalueX = weight * width * pageX * -1 - 5;
      var newvalueY = weight * height * pageY * -1 - 5;
      // upper bound the movement
      if (Math.abs(newvalueX) > 10) {
        newvalueX = Math.sign(newvalueX) * 10;
      }
      if (Math.abs(newvalueY) > 10) {
        newvalueY = Math.sign(newvalueY) * 10;
      }
      $(".intro-header").css("background-position", newvalueX + "px " + newvalueY + "px");
    });
});

// Navigation Scripts to Show Header on Scroll-Up
jQuery(document).ready(function($) {
    var MQL = 1170;

    //primary navigation slide-in effect
    if ($(window).width() > MQL) {
        var headerHeight = $('.navbar-custom').height();
        $(window).on('scroll', {
                previousTop: 0
            },
            function() {
                var currentTop = $(window).scrollTop();
                //check if user is scrolling up
                if (currentTop < this.previousTop) {
                    //if scrolling up...
                    if (currentTop > 0 && $('.navbar-custom').hasClass('is-fixed')) {
                        $('.navbar-custom').addClass('is-visible');
                    } else {
                        $('.navbar-custom').removeClass('is-visible is-fixed');
                    }
                } else if (currentTop > this.previousTop) {
                    //if scrolling down...
                    $('.navbar-custom').removeClass('is-visible');
                    if (currentTop > headerHeight && !$('.navbar-custom').hasClass('is-fixed')) $('.navbar-custom').addClass('is-fixed');
                }
                this.previousTop = currentTop;
            });
    }
});

function preloader() {
    if (document.images) {

        var pages = ['about', 'resume', 'contact', 'home'];
        var images = new Array();
        pages.map(function(item, i) {
            images[i] = new Image();
            images[i].src = "img/"+item+"-bg.jpg";
        })
    }
}

function addLoadEvent(func) {
    var oldonload = window.onload;
    if (typeof window.onload != 'function') {
        window.onload = func;
    } else {
        window.onload = function() {
            if (oldonload) {
                oldonload();
            }
            func();
        }
    }
}

addLoadEvent(preloader);
